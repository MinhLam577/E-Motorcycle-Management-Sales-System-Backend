import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateOptionValueDto } from './dto/create-option_value.dto';
import { UpdateOptionValueDto } from './dto/update-option_value.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { OptionValue } from './entities/option_value.entity';
import { Repository } from 'typeorm';
import { Skus } from '../skus/entities/skus.entity';

@Injectable()
export class OptionValueService {
  constructor(
    @InjectRepository(OptionValue)
    private readonly optionValueRepository: Repository<OptionValue>,
    @InjectRepository(Skus)
    private readonly SkusRepository: Repository<Skus>,
  ) {}
  async create(createOptionValueDto: CreateOptionValueDto) {
    const { optionId, value, skusId } = createOptionValueDto;

    // Kiểm tra xem optionId và value đã tồn tại chưa
    const existingOptionValue = await this.optionValueRepository.findOne({
      where: {
        option: { id: optionId }, // Kiểm tra optionId trong bảng option
        value: value, // Kiểm tra value trực tiếp trong option_value
      },
      relations: ['option'], // Join với bảng option
    });

    if (existingOptionValue) {
      throw new BadRequestException(
        'Value của Option value đã tồn tại. Vui lòng chọn giá trị khác!',
      );
    }

    // Nếu không trùng, tiến hành tạo mới
    const newOptionValue = this.optionValueRepository.create({
      value: value,
      option: { id: optionId },
      skus: { id: skusId },
    });
    return await this.optionValueRepository.save(newOptionValue);
  }

  findAll() {
    return this.optionValueRepository
      .createQueryBuilder('option_value')
      .leftJoinAndSelect('option_value.option', 'option')
      .select([
        'option.id',
        'option.name',
        'option_value.id',
        'option_value.value',
      ])
      .getMany();
  }

  async findOnebyIdproduct(productId: string) {
    const result = await this.optionValueRepository
      .createQueryBuilder('option_value')
      .leftJoinAndSelect('option_value.option', 'option')
      .where('option_value.product_id = :productId', { productId })
      .select([
        'option.id AS option_id', // ID của option
        'option.name AS option_name', // Tên option
        `ARRAY_AGG(
          option_value.id || '::' || option_value.value
        ) AS values`, // Kết hợp ID và value thành chuỗi
      ])
      .groupBy('option.id')
      .addGroupBy('option.name')
      .getRawMany();

    // Format lại kết quả để thành mảng object
    const formattedResult = result.map((item) => ({
      option_id: item.option_id,
      option_name: item.option_name,
      values: item.values.map((val: string) => {
        const [id_option_value, value] = val.split('::'); // Tách chuỗi thành id và value
        return { id_option_value, value };
      }),
    }));

    return formattedResult;
  }

  update(id: number, updateOptionValueDto: UpdateOptionValueDto) {
    return `This action updates a #${id} optionValue`;
  }

  remove(id: number) {
    return `This action removes a #${id} optionValue`;
  }
}
