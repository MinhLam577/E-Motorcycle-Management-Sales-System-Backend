import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateReceiveAddressDto } from './dto/create-receive_address.dto';
import { UpdateReceiveAddressDto } from './dto/update-receive_address.dto';
import { BaseService } from '../Base/Base.service';
import { ResponseReceiveAddressDto } from './dto/response-receive_address.dto';
import { ReceiveAddressEntity } from './entities/receive_address.entity';
import { Brackets, EntityManager, Repository } from 'typeorm';
import { transformDto } from 'src/helpers/transformObjectDto';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class ReceiveAddressService extends BaseService<
  ReceiveAddressEntity,
  CreateReceiveAddressDto,
  UpdateReceiveAddressDto,
  ResponseReceiveAddressDto
> {
  constructor(
    @InjectRepository(ReceiveAddressEntity)
    private receiveAddressRepo: Repository<ReceiveAddressEntity>,
  ) {
    super(
      receiveAddressRepo,
      CreateReceiveAddressDto,
      UpdateReceiveAddressDto,
      ResponseReceiveAddressDto,
      'Receive address',
    );
  }

  async checkExistReceiveAddress(
    dto: CreateReceiveAddressDto | UpdateReceiveAddressDto,
    excludeId?: string,
  ): Promise<boolean> {
    const { customerId, street, ward, district } = dto;
    const existingReceiveAddress = this.receiveAddressRepo
      .createQueryBuilder('receive_address')
      .where('receive_address.customer_id = :customerId', { customerId });

    if (excludeId) {
      existingReceiveAddress.andWhere('receive_address.id != :excludeId', {
        excludeId,
      });
    }
    const res = await existingReceiveAddress
      .andWhere(
        new Brackets((qb) => {
          qb.where(
            new Brackets((sub_qb) =>
              sub_qb
                .where(
                  'unaccent(LOWER(receive_address.street)) = unaccent(LOWER(:street))',
                  { street },
                )
                .andWhere(
                  'unaccent(LOWER(receive_address.district)) = unaccent(LOWER(:district))',
                  { district },
                ),
            ),
          ).orWhere(
            new Brackets((sub_qb) => {
              sub_qb
                .where(
                  'unaccent(LOWER(receive_address.street)) = unaccent(LOWER(:street))',
                  { street },
                )
                .andWhere(
                  'unaccent(LOWER(receive_address.ward)) = unaccent(LOWER(:ward))',
                  { ward },
                );
            }),
          );
        }),
      )
      .getOne();
    return !!res;
  }
  async create(dto: CreateReceiveAddressDto): Promise<{
    status: number;
    message: string;
    data: ResponseReceiveAddressDto;
  }> {
    try {
      const { customerId } = dto;
      const customer = await this.receiveAddressRepo.manager.findOne(
        'Customer',
        {
          where: {
            id: customerId,
          },
        },
      );
      if (!customer) {
        throw new NotFoundException('Customer not found');
      }

      const count = await this.receiveAddressRepo.count({
        where: {
          customer: { id: customerId },
        },
      });

      if (count >= 3) {
        throw new BadRequestException(
          'You can only have max 3 receive address',
        );
      }

      const isDuplicate = await this.checkExistReceiveAddress(dto);
      if (isDuplicate) {
        throw new ConflictException(
          'This address already exists for the customer',
        );
      }
      const newReceiveAddress = {
        ...dto,
        customer: customer,
      };
      const result = await this.receiveAddressRepo.save(newReceiveAddress);
      const transformResult = transformDto(ResponseReceiveAddressDto, result);
      return {
        status: 201,
        message: 'Create receive address successfully',
        data: transformResult,
      };
    } catch (e) {
      console.error('Lỗi tạo địa chỉ: ', e);
      if (
        e instanceof Object &&
        e !== null &&
        'code' in e &&
        e.code === '23505'
      ) {
        throw new ConflictException(
          'This address already exists for the customer',
        );
      }
      throw e;
    }
  }

  async update(
    id: string,
    dto: UpdateReceiveAddressDto,
  ): Promise<{
    status: number;
    message: string;
    data: ResponseReceiveAddressDto;
  }> {
    try {
      const oldData = await this.receiveAddressRepo.findOne({
        where: { id: id },
      });
      if (!oldData) {
        throw new NotFoundException('Receive address not found');
      }
      const { customerId } = dto;
      const customer = await this.receiveAddressRepo.manager.findOne(
        'Customer',
        {
          where: {
            id: customerId,
          },
        },
      );
      if (!customer) {
        throw new NotFoundException('Customer not found');
      }

      const isDuplicate = await this.checkExistReceiveAddress(dto, id);
      if (isDuplicate) {
        throw new ConflictException(
          'This address already exists for the customer',
        );
      }

      const newReceiveAddress = {
        ...oldData,
        ...dto,
        id,
        customer: customer,
      };

      const result = await this.receiveAddressRepo.save(newReceiveAddress);
      const transformResult = transformDto(ResponseReceiveAddressDto, result);
      return {
        status: 200,
        message: 'Update receive address successfully',
        data: transformResult,
      };
    } catch (e) {
      if (
        e instanceof Object &&
        e !== null &&
        'code' in e &&
        e.code === '23505'
      ) {
        throw new ConflictException(
          'This address already exists for the customer',
        );
      }
      throw e;
    }
  }

  async removeDefaultAllReceiveAddressByCustomerId(
    manager: EntityManager,
    customerId: string,
  ): Promise<number> {
    const res = await manager.update(
      this.receiveAddressRepo.target,
      {
        customer: { id: customerId },
        is_default: true,
      },
      {
        is_default: false,
      },
    );
    return res.affected || 0;
  }

  async setDefaultReceiveAddress(id: string): Promise<{
    status: number;
    message: string;
  }> {
    try {
      return await this.receiveAddressRepo.manager.transaction(
        async (manager) => {
          const receiveAddress = await manager.findOne(
            this.receiveAddressRepo.target,
            {
              where: {
                id,
              },
              relations: ['customer'],
            },
          );
          if (!receiveAddress) {
            throw new NotFoundException('Receive address not found');
          }

          if (receiveAddress.is_default)
            throw new ConflictException('Receive address is already default');

          await this.removeDefaultAllReceiveAddressByCustomerId(
            manager,
            receiveAddress.customer.id,
          );
          const res = await manager.update(this.receiveAddressRepo.target, id, {
            is_default: true,
          });

          if (res.affected === 0) {
            throw new ConflictException('Set default receive address failed');
          }
          return {
            status: 200,
            message: 'Set default receive address successfully',
          };
        },
      );
    } catch (e) {
      throw e;
    }
  }

  async getDefaultReceiveAddressByCustomerId(
    customerId: string,
  ): Promise<ResponseReceiveAddressDto> {
    try {
      const customer = await this.receiveAddressRepo.manager.findOne(
        'Customer',
        {
          where: {
            id: customerId,
          },
        },
      );
      if (!customer) {
        throw new NotFoundException('Customer not found');
      }
      const receiveAddress = await this.receiveAddressRepo.manager.findOne(
        'ReceiveAddressEntity',
        {
          where: {
            customer: { id: customerId },
            is_default: true,
          },
          relations: ['customer'],
        },
      );
      if (!receiveAddress) {
        throw new NotFoundException('No default receive address found');
      }
      return transformDto(ResponseReceiveAddressDto, receiveAddress);
    } catch (e) {
      throw e;
    }
  }

  async findAll(relations?: string[]): Promise<ResponseReceiveAddressDto[]> {
    return await super.findAll(relations);
  }

  async findOneBy(
    prop: string,
    value: string,
    relations?: string[],
  ): Promise<{
    status: number;
    message: string;
    data: ResponseReceiveAddressDto;
  }> {
    return await super.findOneBy(prop, value, relations);
  }

  async getAllByCustomerId(
    customerId: string,
  ): Promise<ResponseReceiveAddressDto[]> {
    try {
      const customer = await this.receiveAddressRepo.manager.findOne(
        'Customer',
        {
          where: {
            id: customerId,
          },
        },
      );
      if (!customer) {
        throw new NotFoundException('Customer not found');
      }
      const receiveAddress = await this.receiveAddressRepo.manager.find(
        'ReceiveAddressEntity',
        {
          where: {
            customer: { id: customerId },
          },
          relations: ['customer'],
        },
      );
      if (!receiveAddress || receiveAddress.length === 0) {
        throw new NotFoundException('No receive address found');
      }
      return receiveAddress.map((e) =>
        transformDto(ResponseReceiveAddressDto, e),
      );
    } catch (e) {
      throw e;
    }
  }

  async remove(id: string): Promise<{
    status: boolean;
    message: string;
    data: ResponseReceiveAddressDto;
  }> {
    return await super.remove(id);
  }
}
