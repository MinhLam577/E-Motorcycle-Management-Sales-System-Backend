import { Controller, Get, Param } from '@nestjs/common';
import { WardService } from './ward.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Tag } from 'src/constants/api-tag.enum';
import { Public } from 'src/decorators/public-route';
import { PositiveIntPipe } from 'src/pipe/positive-integer.pipe';
@Controller('ward')
@ApiTags(Tag.WARD)
@Public()
export class WardController {
  constructor(private readonly wardService: WardService) {}

  @Get(':districtCode')
  @ApiOperation({
    summary: 'Get ward by districtCode',
    description: `Get all ward filters by  \n
          districtCode: code of the district
    `,
  })
  async getWardByDistrictCode(
    @Param('districtCode', PositiveIntPipe) districtCode: number,
  ) {
    return await this.wardService.getWardByDistrictCode(districtCode);
  }
}
