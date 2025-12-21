import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateVourcherDto } from './dto/create-vourcher.dto';
import { UpdateVourcherDto } from './dto/update-vourcher.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Voucher } from './entities/vourcher.entity';
import { In, Repository } from 'typeorm';
import { UserVourcher } from '../user_vourcher/entities/user_vourcher.entity';
import { Customer } from '../customers/entities/customer.entity';
import { TypeVoucher } from '../type_voucher/entities/type_voucher.entity';
import { WsException } from '@nestjs/websockets';
import { CreateCustomer_VourcherDto } from './dto/create_customer_voucher.dto';

@Injectable()
export class VourchersService {
  constructor(
    @InjectRepository(Voucher)
    private voucherRepository: Repository<Voucher>,
    @InjectRepository(UserVourcher)
    private userVoucherRepository: Repository<UserVourcher>,
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(TypeVoucher)
    private typeVoucherRepository: Repository<TypeVoucher>,
  ) {}
  async create(createVourcherDto: CreateVourcherDto) {
    try {
      const { type_voucher_id, ...dataVoucher } = createVourcherDto;

      const findTypeVoucher = await this.typeVoucherRepository.findOne({
        where: { id: type_voucher_id },
      });

      if (!findTypeVoucher) {
        throw new NotFoundException('Không tìm thấy loại voucher này');
      }

      const createVoucher = this.voucherRepository.create({
        ...dataVoucher,
        type_voucher: findTypeVoucher,
      });

      const savedVoucher = await this.voucherRepository.save(createVoucher);

      return {
        status: 200,
        message: 'Tạo thành công voucher',
        data: savedVoucher,
      };
    } catch (error) {
      console.error('Error creating voucher:', error);
      throw new InternalServerErrorException(
        'Đã có lỗi xảy ra khi tạo voucher',
      );
    }
  }

  // tặng voucher
  async give_for_customer(
    id: string,
    createCreateCustomer_VourcherDto: CreateCustomer_VourcherDto,
  ) {
    const { customer_ids } = createCreateCustomer_VourcherDto;
    const findVoucher = await this.voucherRepository.findOne({
      where: { id: id },
    });

    if (!findVoucher) {
      throw new NotFoundException('Không tìm thấy  voucher này ');
    }

    if (customer_ids && Array.isArray(customer_ids)) {
      // Tạo mảng các thực thể UserVourcher
      const userVouchers = customer_ids.map((customerId) => {
        const userVoucher = this.userVoucherRepository.create({
          customer: { id: customerId } as Customer, // Gán customer bằng ID
          voucher: findVoucher, // Gán voucher đã có
          is_used: false, // Mặc định chưa sử dụng
          used_at: null, // Chưa có ngày sử dụng
        });
        return userVoucher;
      });

      // Lưu tất cả UserVourcher vào cơ sở dữ liệu
      await this.userVoucherRepository.save(userVouchers);

      return {
        status: 200,
        message: 'Tặng voucher cho khách hàng thành công',
        data: userVouchers,
      }; // Trả về danh sách các UserVourcher vừa tạo (tuỳ chọn)
    } else {
      throw new Error('customer_ids must be a valid array of customer IDs');
    }
  }
  async findAll() {
    const data = await this.voucherRepository.find();
    return {
      status: 200,
      message: 'Lấy Danh sách voucher thành công',
      data: data,
    };
  }

  async findOne(id: string) {
    const data = await this.voucherRepository.findOne({
      where: { id },
      relations: ['type_voucher'],
    });

    if (!data) {
      throw new NotFoundException('Không tìm thấy voucher với ID đã cung cấp');
    }

    return {
      status: 200,
      message: 'Lấy voucher thành công',
      data,
    };
  }

  async update(id: string, updateVourcherDto: UpdateVourcherDto) {
    try {
      const { type_voucher_id, ...dataUpdate } = updateVourcherDto;

      const voucher = await this.voucherRepository.findOne({
        where: { id },
        relations: ['type_voucher'],
      });

      if (!voucher) {
        throw new NotFoundException('Không tìm thấy voucher');
      }

      // Gán các field được cập nhật
      Object.assign(voucher, dataUpdate);

      // Nếu có truyền type_voucher_id thì kiểm tra và gán quan hệ
      if (type_voucher_id) {
        const typeVoucher = await this.typeVoucherRepository.findOne({
          where: { id: type_voucher_id },
        });

        if (!typeVoucher) {
          throw new NotFoundException('Không tìm thấy loại voucher');
        }

        voucher.type_voucher = typeVoucher;
      }

      await this.voucherRepository.save(voucher);

      return {
        status: 200,
        message: 'Cập nhật voucher thành công',
      };
    } catch (error) {
      console.error('Lỗi khi cập nhật voucher:', error);

      // Nếu là lỗi đã biết thì ném lại
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Có lỗi xảy ra khi cập nhật voucher',
      );
    }

    // Nếu DTO có thêm trường users để cập nhật UserVoucher
    // if (updateVourcherDto['users']) {
    //   voucher.users = updateVourcherDto['users']; // Cần xử lý thêm tùy vào yêu cầu
    // }
  }

  async remove(id: string) {
    const voucher = await this.voucherRepository.findOne({
      where: { id },
      relations: ['users'], // Load quan hệ users
    });

    if (!voucher) {
      throw new NotFoundException(`Voucher with ID ${id} not found`);
    }

    // Xóa các UserVoucher liên quan
    if (voucher.users && voucher.users.length > 0) {
      await this.userVoucherRepository.delete({ voucher: { id: voucher.id } });
    }

    // Xóa voucher
    const deleted = await this.voucherRepository.delete(id);
    return {
      status: 200,
      message: 'Xóa voucher thành công',
    };
  }

  async getVoucherById(customer_id: string, voucher: { voucherCode: string }) {
    const getvoucher = await this.voucherRepository.findOne({
      where: { id: voucher.voucherCode },
    });

    if (!getvoucher) {
      throw new Error('Voucher không tồn tại');
    }

    const existUserVoucher = await this.userVoucherRepository.findOne({
      where: {
        customer: { id: customer_id },
        voucher: { id: getvoucher.id },
      },
    });

    if (existUserVoucher) {
      throw new Error('Bạn đã sở hữu voucher này rồi');
    }

    const customerCheck = await this.customerRepository.findOne({
      where: { id: customer_id },
    });

    if (!customerCheck) {
      throw new Error('Khách hàng không tồn tại');
    }

    if (getvoucher.count_user_get >= getvoucher.limit) {
      throw new WsException('Voucher đã hết lượt sử dụng');
    }

    const saleVoucher = this.userVoucherRepository.create({
      customer: { id: customer_id } as Customer,
      voucher: getvoucher,
      is_used: false,
      used_at: null,
    });

    await this.userVoucherRepository.save(saleVoucher);
    await this.voucherRepository.increment(
      { id: getvoucher.id },
      'count_user_get',
      1,
    );

    return this.findAll();
  }
  async getListCustomer_NoVoucher(id: string) {
    const getVoucherByID = await this.voucherRepository.findOne({
      where: { id: id },
      relations: ['users.customer'],
    });

    const userIDs = getVoucherByID?.users?.map((user) => {
      return user.customer.id;
    });
    //  lấy danh sách customer
    const getListCustomer = await this.customerRepository.find();
    const customerIDs_No_Voucher = getListCustomer.filter(
      (element) => !userIDs.includes(element.id),
    );
    return customerIDs_No_Voucher;
  }
}
